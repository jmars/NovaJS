// Relative base paths (no leading slash) so the client works when served
// from any base URL (e.g. GitHub Pages /NovaJS/) as well as local dev.
// Server code must prepend '/' when registering these with express.
export const prefix = "gameData/";
export const dataPath = prefix + "data";
export const idsPath = prefix + "ids";
export const settingsPrefix = "settings/";
