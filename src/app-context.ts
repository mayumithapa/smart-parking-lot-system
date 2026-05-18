import type Database from "better-sqlite3";

import type { DB } from "./db/index.js";
import { ParkingService } from "./services/parking-service.js";

export interface AppContext {
  db: DB;
  sqlite: Database.Database;
  parking: ParkingService;
}

export function createContext(args: {
  db: DB;
  sqlite: Database.Database;
}): AppContext {
  return {
    db: args.db,
    sqlite: args.sqlite,
    parking: new ParkingService(),
  };
}
