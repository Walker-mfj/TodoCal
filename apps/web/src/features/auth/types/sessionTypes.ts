import type { components } from "../../../shared/api/apiTypes.generated";
import type { Settings } from "../../../shared/api/domainTypes";
export type Session = components["schemas"]["Session"] & { settings: Settings };
