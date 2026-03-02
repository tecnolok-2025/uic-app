// Fuente única de verdad para la versión visible en la app.
// Se toma desde uic-app-pwa/package.json
import pkg from "../package.json";
export const APP_VERSION = pkg.version;
