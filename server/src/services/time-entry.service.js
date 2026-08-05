import { withTransaction } from "../config/db.js";
import { AppError } from "../lib/app-error.js";
import {
  calculateHours,
  validateDailyHours,
  validateNoOverlap,
} from "../lib/time.js";

import { activityRepository } from "../repositories/activity.repository.js";
import { kitRepository } from "../repositories/kit.repository.js";
import { projectRepository } from "../repositories/project.repository.js";
import { timeEntryRepository } from "../repositories/time-entry.repository.js";

import { syncService } from "./sync.service.js";



function normalizeTime(value) {

  if (!value) return "";

  // MariaDB TIME returns HH:mm:ss
  // Frontend input returns HH:mm

  return value.length === 8
    ? value.substring(0,5)
    : value;

}



async function hydrateRows(rows, employee, options = {}) {

  const activityCache = new Map();
  const projectCache = new Map();


  return Promise.all(

    rows.map(async(row)=>{


      const activityName =
        String(row.activity || "").trim();



      if(!activityName){

        throw new AppError(
          400,
          "Activity is required"
        );

      }



      let activity =
        activityCache.get(activityName);



      if(!activity){

        activity =
          await activityRepository.findByName(activityName);


        if(!activity){

          throw new AppError(
            400,
            `Unknown activity type: ${activityName}`
          );

        }


        activityCache.set(
          activityName,
          activity
        );

      }




      let project = null;



      if(activity.name === "Project"){


        if(!row.project){

          throw new AppError(
            400,
            "Project is required when activity is Project"
          );

        }



        project =
          projectCache.get(row.project);



        if(!project){


          project =
            await projectRepository.findAccessibleByCode(
              employee,
              row.project
            );


          if(!project){

            throw new AppError(
              400,
              `Invalid project code: ${row.project}`
            );

          }


          projectCache.set(
            row.project,
            project
          );

        }

      }




      const identifiers =
        String(row.kits || "")
          .split(/[|,\s]+/)
          .map(item=>item.trim())
          .filter(Boolean);



      const resolvedKits =
        identifiers.length
          ? await kitRepository.resolveMany(
              identifiers
            )
          : [];




      const foundIdentifiers = new Set();



      for(const kit of resolvedKits){

        if(kit.serial_number){

          foundIdentifiers.add(
            kit.serial_number
          );

        }


        if(kit.part_code){

          foundIdentifiers.add(
            kit.part_code
          );

        }

      }




      const missingKits =
        identifiers.filter(
          item =>
            !foundIdentifiers.has(item)
        );



      if(missingKits.length){

        if (options.upsertMissing) {
          for (const missing of missingKits) {
            const newKit = await kitRepository.upsert({
              project_ja_code: row.project ?? null,
              part_code: "",
              serial_number: missing,
              device_type: "Auto-Created",
              brand: "Unknown",
              model: "Unknown",
            });
            resolvedKits.push(newKit);
          }
        } else {
          for (const missing of missingKits) {
            resolvedKits.push({
              id: -1,
              project_ja_code: row.project ?? null,
              part_code: "",
              serial_number: missing,
              device_type: "Auto-Created",
              brand: "Unknown",
              model: "Unknown",
            });
          }
        }

      }




      const fromTime =
        normalizeTime(row.from_time);


      const toTime =
        normalizeTime(row.to_time);



      if(!fromTime || !toTime){

        throw new AppError(
          400,
          "Start and end time are required"
        );

      }




      return {

        entry_date: row.date,

        activity_type_id:
          activity.id,

        activity_name:
          activity.name,


        project_id:
          project?.id ?? null,


        project_code:
          project?.ja_code ?? null,

        order_num: row.order_num ?? null,

        from_time:
          fromTime,


        to_time:
          toTime,


        overtime:
          Boolean(row.overtime),


        hours:
          calculateHours(
            fromTime,
            toTime
          ),


        kit_identifiers:
          identifiers,


        resolvedKits

      };


    })

  );

}


function detectDuplicate(existing, entries) {

  for (const oldEntry of existing) {

    const oldFrom = normalizeTime(oldEntry.from_time);
    const oldTo = normalizeTime(oldEntry.to_time);


    for (const newEntry of entries) {

      if (
        oldFrom === newEntry.from_time &&
        oldTo === newEntry.to_time
      ) {

        throw new AppError(
          400,
          `Duplicate time entry already exists: ${oldFrom}-${oldTo}`
        );

      }

    }

  }

}


export const timeEntryService = {



  async listForDate(employeeId,date){

    return timeEntryRepository.findByEmployeeAndDate(
      employeeId,
      date
    );

  },





  async validateEntries(employee, rows, options = {}){


    if(!Array.isArray(rows) || rows.length===0){

      throw new AppError(
        400,
        "At least one time entry is required"
      );

    }



    const hydrated =
      await hydrateRows(rows, employee, options);
    



    validateNoOverlap(
      hydrated
    );



    const totalHours =
      validateDailyHours(
        hydrated,
        employee.working_hours_per_day,
      );



    return {

      entries: hydrated,

      totalHours

    };


  },







  async createEntries(
    employee,
    rows,
    options={}
  ){


    const {
      sync=true
    } = options;



    if(!employee?.id){

      throw new AppError(
        401,
        "Invalid employee"
      );

    }




    const {
      entries,
      totalHours
    } =
      await this.validateEntries(employee, rows, { upsertMissing: true });





    const existing =
      await timeEntryRepository.findByEmployeeAndDate(
        employee.id,
        entries[0].entry_date
      );



    const combined = [

      ...existing.map(entry=>({

        from_time:
          normalizeTime(entry.from_time),

        to_time:
          normalizeTime(entry.to_time),

        overtime:
          Boolean(entry.overtime)

      })),


      ...entries

    ];





    validateNoOverlap(
      combined
    );


    validateDailyHours(
      combined,
      employee.working_hours_per_day,
    );






    const savedEntries =
      await withTransaction(
        async(client)=>{


          const inserted =
            await timeEntryRepository.insertMany(
              client,
              employee.id,
              entries
            );





          for(
            let i=0;
            i<inserted.length;
            i++
          ){


            const saved =
              inserted[i];


            const kits =
              entries[i].resolvedKits;



            for(const kit of kits){


              await client.query(
                `
                INSERT INTO time_entry_kits
                (
                  time_entry_id,
                  kit_id
                )
                VALUES
                (?,?)
                `,
                [
                  saved.id,
                  kit.id
                ]
              );


            }

          }



          return inserted;


        }
      );







    let syncResult = {

      synced:false,

      reason:"Sync skipped"

    };





if(sync){

 try {

   syncResult =
     await syncService.syncTimeEntries(
       entries,
       employee
     );

 }
 catch(error){

   syncResult={
     synced:false,
     reason:error.message
   };

 }

}





    return {

      savedEntries,

      totalHours,

      sync:
        syncResult

    };


  }


};
