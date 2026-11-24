// src/domain/sample-data.ts
//
// The setting that marks a database as sample data: "true" on every database
// demo/build-sample-db.ts builds. Its own file so the server can read the stamp without
// loading the demo household.
export const SAMPLE_STAMP_KEY = "sample_data";
