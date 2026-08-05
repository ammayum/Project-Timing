import { getActiveReadEngine, pool } from "../config/db.js";

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
}

function mapProjectRow(row) {
  return {
    ...row,
    kits: parseJsonArray(row.kits),
    teams: parseJsonArray(row.teams),
    managers: parseJsonArray(row.managers),
  };
}

export const projectRepository = {
  async ensureTables() {
    const engine = await getActiveReadEngine();

    await pool.query(
      engine === "postgres"
        ? `
          CREATE TABLE IF NOT EXISTS project_teams (
            project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            PRIMARY KEY (project_id, team_id)
          )
        `
        : `
          CREATE TABLE IF NOT EXISTS project_teams (
            project_id BIGINT NOT NULL,
            team_id BIGINT NOT NULL,
            PRIMARY KEY (project_id, team_id)
          )
        `,
    );

    await pool.query(
      engine === "postgres"
        ? `
          CREATE TABLE IF NOT EXISTS project_managers (
            project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            assignment_role VARCHAR(100) NOT NULL DEFAULT 'Manager',
            PRIMARY KEY (project_id, employee_id)
          )
        `
        : `
          CREATE TABLE IF NOT EXISTS project_managers (
            project_id BIGINT NOT NULL,
            employee_id BIGINT NOT NULL,
            assignment_role VARCHAR(100) NOT NULL DEFAULT 'Manager',
            PRIMARY KEY (project_id, employee_id)
          )
        `,
    );
  },

  buildVisibilityJoin(user) {
    if (!user || user.is_admin) {
      return {
        join: "",
        where: "1 = 1",
        params: [],
      };
    }

    return {
      join: `
        LEFT JOIN project_teams vpt
          ON vpt.project_id = p.id
        LEFT JOIN project_managers vpm
          ON vpm.project_id = p.id
      `,
      where: `
        (
          (vpt.team_id IS NOT NULL AND vpt.team_id = ?)
          OR
          (vpm.employee_id IS NOT NULL AND vpm.employee_id = ?)
        )
      `,
      params: [user.team_id ?? 0, user.id],
    };
  },

  async listActive(user = null) {
    const visibility = this.buildVisibilityJoin(user);

    const [rows] = await pool.query(
      `
      SELECT DISTINCT
        p.id,
        p.\`Ja_Code\` AS ja_code,
        p.\`Project_Name\` AS project_name,
        p.\`FD_Ref\` AS fd_ref,
        p.\`Status\` AS status,
        p.\`Channel\` AS channel,
        p.\`Project_Description\` AS project_description,
        p.\`Company\` AS company,
        p.\`Suffix\` AS suffix
      FROM projects p
      ${visibility.join}
      WHERE p.\`Status\` = 'active'
        AND ${visibility.where}
      ORDER BY p.\`Ja_Code\` ASC, p.\`Suffix\` ASC
      `,
      visibility.params,
    );

    return rows;
  },

  async findByCode(jaCode) {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        \`Ja_Code\` AS ja_code,
        \`Project_Name\` AS project_name,
        \`FD_Ref\` AS fd_ref,
        \`Status\` AS status,
        \`Channel\` AS channel,
        \`Project_Description\` AS project_description,
        \`Company\` AS company,
        \`Suffix\` AS suffix
      FROM projects
      WHERE \`Ja_Code\` = ?
      `,
      [jaCode],
    );
    return rows[0] ?? null;
  },

  async findAccessibleByCode(user, jaCode) {
    const visibility = this.buildVisibilityJoin(user);

    const [rows] = await pool.query(
      `
      SELECT DISTINCT
        p.id,
        p.\`Ja_Code\` AS ja_code,
        p.\`Project_Name\` AS project_name,
        p.\`FD_Ref\` AS fd_ref,
        p.\`Status\` AS status,
        p.\`Channel\` AS channel,
        p.\`Project_Description\` AS project_description,
        p.\`Company\` AS company,
        p.\`Suffix\` AS suffix
      FROM projects p
      ${visibility.join}
      WHERE p.\`Ja_Code\` = ?
        AND p.\`Status\` = 'active'
        AND ${visibility.where}
      LIMIT 1
      `,
      [jaCode, ...visibility.params],
    );

    return rows[0] ?? null;
  },

  async findById(id) {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        \`Ja_Code\` AS ja_code,
        \`Project_Name\` AS project_name,
        \`FD_Ref\` AS fd_ref,
        \`Status\` AS status,
        \`Channel\` AS channel,
        \`Project_Description\` AS project_description,
        \`Company\` AS company,
        \`Suffix\` AS suffix
      FROM projects
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );
    return rows[0] ?? null;
  },

  async listAllWithKits(user = null) {
    const visibility = this.buildVisibilityJoin(user);
    const engine = await getActiveReadEngine();

    const sql = engine === "postgres"
      ? `
        SELECT
          p.id,
          p.\`Ja_Code\` AS ja_code,
          p.\`Project_Name\` AS project_name,
          p.\`FD_Ref\` AS fd_ref,
          p.\`Status\` AS status,
          p.\`Channel\` AS channel,
          p.\`Project_Description\` AS project_description,
          p.\`Company\` AS company,
          p.\`Suffix\` AS suffix,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', k.id,
                'project_id', k.project_id,
                'part_code', k.part_code,
                'serial_number', k.serial_number,
                'device_type', k.device_type,
                'brand', k.brand,
                'model', k.model,
                'project_code', p.\`Ja_Code\`,
                'project_name', p.\`Project_Name\`
              )
            ) FILTER (WHERE k.id IS NOT NULL),
            '[]'::json
          ) AS kits,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', t.id,
                'name', t.name
              )
            ) FILTER (WHERE t.id IS NOT NULL),
            '[]'::json
          ) AS teams,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', m.id,
                'name', m.name,
                'email', m.email,
                'assignment_role', pm.assignment_role
              )
            ) FILTER (WHERE m.id IS NOT NULL),
            '[]'::json
          ) AS managers
        FROM projects p
        LEFT JOIN kits k
          ON k.project_ja_code = p.\`Ja_Code\`
        LEFT JOIN project_teams pt
          ON pt.project_id = p.id
        LEFT JOIN teams t
          ON t.id = pt.team_id
        LEFT JOIN project_managers pm
          ON pm.project_id = p.id
        LEFT JOIN employees m
          ON m.id = pm.employee_id
        ${visibility.join}
        WHERE ${visibility.where}
        GROUP BY p.id
        ORDER BY p.\`Ja_Code\` ASC, p.\`Suffix\` ASC
      `
      : `
        SELECT
          p.id,
          p.\`Ja_Code\` AS ja_code,
          p.\`Project_Name\` AS project_name,
          p.\`FD_Ref\` AS fd_ref,
          p.\`Status\` AS status,
          p.\`Channel\` AS channel,
          p.\`Project_Description\` AS project_description,
          p.\`Company\` AS company,
          p.\`Suffix\` AS suffix,
          COALESCE(
            JSON_ARRAYAGG(
              DISTINCT CASE
                WHEN k.id IS NOT NULL THEN JSON_OBJECT(
                  'id', k.id,
                  'project_id', k.project_id,
                  'part_code', k.part_code,
                  'serial_number', k.serial_number,
                  'device_type', k.device_type,
                  'brand', k.brand,
                  'model', k.model,
                  'project_code', p.\`Ja_Code\`,
                  'project_name', p.\`Project_Name\`
                )
                ELSE NULL
              END
            ),
            JSON_ARRAY()
          ) AS kits,
          COALESCE(
            JSON_ARRAYAGG(
              DISTINCT CASE
                WHEN t.id IS NOT NULL THEN JSON_OBJECT(
                  'id', t.id,
                  'name', t.name
                )
                ELSE NULL
              END
            ),
            JSON_ARRAY()
          ) AS teams,
          COALESCE(
            JSON_ARRAYAGG(
              DISTINCT CASE
                WHEN m.id IS NOT NULL THEN JSON_OBJECT(
                  'id', m.id,
                  'name', m.name,
                  'email', m.email,
                  'assignment_role', pm.assignment_role
                )
                ELSE NULL
              END
            ),
            JSON_ARRAY()
          ) AS managers
        FROM projects p
        LEFT JOIN kits k
          ON k.project_ja_code = p.\`Ja_Code\`
        LEFT JOIN project_teams pt
          ON pt.project_id = p.id
        LEFT JOIN teams t
          ON t.id = pt.team_id
        LEFT JOIN project_managers pm
          ON pm.project_id = p.id
        LEFT JOIN employees m
          ON m.id = pm.employee_id
        ${visibility.join}
        WHERE ${visibility.where}
        GROUP BY p.id
        ORDER BY p.\`Ja_Code\` ASC, p.\`Suffix\` ASC
      `;

    const [rows] = await pool.query(sql, visibility.params);
    return rows.map(mapProjectRow);
  },

  async setTeams(projectId, teamIds = []) {
    await this.ensureTables();
    await pool.query("DELETE FROM project_teams WHERE project_id = ?", [projectId]);

    for (const teamId of teamIds) {
      await pool.query(
        `
        INSERT INTO project_teams (project_id, team_id)
        VALUES (?, ?)
        `,
        [projectId, teamId],
      );
    }
  },

  async setManagers(projectId, managerIds = []) {
    await this.ensureTables();
    await pool.query("DELETE FROM project_managers WHERE project_id = ?", [projectId]);

    for (const managerId of managerIds) {
      await pool.query(
        `
        INSERT INTO project_managers (project_id, employee_id, assignment_role)
        VALUES (?, ?, 'Manager')
        `,
        [projectId, managerId],
      );
    }
  },

  async upsert(payload) {
    await this.ensureTables();
    const normalizedJaCode = payload.ja_code?.trim?.() ?? payload.ja_code ?? "";
    const normalizedSuffix = payload.suffix || "";
    let project = null;

    if (payload.id) {
      await pool.query(
        `
        UPDATE projects
        SET
          \`Ja_Code\` = ?,
          \`Project_Name\` = ?,
          \`FD_Ref\` = ?,
          \`Suffix\` = ?,
          \`Status\` = ?
        WHERE id = ?
        `,
        [
          normalizedJaCode,
          payload.project_name,
          payload.fd_ref,
          normalizedSuffix,
          payload.status || "active",
          payload.id,
        ],
      );

      project = await this.findById(payload.id);
    } else {
      const engine = await getActiveReadEngine();

      if (engine === "postgres") {
        await pool.query(
          `
          INSERT INTO projects (\`Ja_Code\`, \`Project_Name\`, \`FD_Ref\`, \`Suffix\`, \`Status\`)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (\`Ja_Code\`, \`Suffix\`) DO UPDATE
          SET
            \`Project_Name\` = EXCLUDED.\`Project_Name\`,
            \`FD_Ref\` = EXCLUDED.\`FD_Ref\`,
            \`Status\` = EXCLUDED.\`Status\`
          `,
          [
            normalizedJaCode,
            payload.project_name,
            payload.fd_ref,
            normalizedSuffix,
            payload.status || "active",
          ],
        );
      } else {
        await pool.query(
          `
          INSERT INTO projects (\`Ja_Code\`, \`Project_Name\`, \`FD_Ref\`, \`Suffix\`, \`Status\`)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            \`Project_Name\` = VALUES(\`Project_Name\`),
            \`FD_Ref\` = VALUES(\`FD_Ref\`),
            \`Status\` = VALUES(\`Status\`)
          `,
          [
            normalizedJaCode,
            payload.project_name,
            payload.fd_ref,
            normalizedSuffix,
            payload.status || "active",
          ],
        );
      }

      const [rows] = await pool.query(
        `
        SELECT
          id,
          \`Ja_Code\` AS ja_code,
          \`Project_Name\` AS project_name,
          \`FD_Ref\` AS fd_ref,
          \`Status\` AS status,
          \`Channel\` AS channel,
          \`Project_Description\` AS project_description,
          \`Company\` AS company,
          \`Suffix\` AS suffix
        FROM projects
        WHERE \`Ja_Code\` = ?
          AND \`Suffix\` = ?
        LIMIT 1
        `,
        [normalizedJaCode, normalizedSuffix],
      );

      project = rows[0] ?? null;
    }

    if (!project) {
      return null;
    }

    await this.setTeams(project.id, payload.team_ids ?? []);
    await this.setManagers(project.id, payload.manager_ids ?? []);

    const projects = await this.listAllWithKits({ is_admin: true });
    return projects.find((item) => item.id === project.id) ?? project;
  },
};
