CREATE TABLE plant_tv_goal (
  id TEXT PRIMARY KEY,
  machine INTEGER NOT NULL UNIQUE,
  pct_85 REAL NOT NULL,
  pct_90 REAL NOT NULL,
  pct_100 REAL NOT NULL,
  pct_112 REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_plant_tv_goal_machine ON plant_tv_goal(machine);
