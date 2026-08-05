export function StatusBanner({ message, tone = "info" }) {
  if (!message) {
    return null;
  }

  const styles = {
    info: "border-bt-purple/30 bg-bt-purple-lightest/40 text-bt-purple-dark",
    error: "border-bt-purple-dark/30 bg-bt-purple-lightest/40 text-bt-purple-deep",
    success: "border-bt-purple/30 bg-bt-purple-lightest/40 text-bt-purple-dark",
  };

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles[tone]}`}>{message}</div>;
}
