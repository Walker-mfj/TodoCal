// The dashboard owns this operational text variable. Unset or exactly false
// enables normal service; true and malformed values fence traffic safely.
export function maintenanceEnabled(env) {
  return env.MAINTENANCE_MODE !== undefined && env.MAINTENANCE_MODE !== 'false';
}
