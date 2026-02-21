CREATE TABLE sales_budget (
  id TEXT PRIMARY KEY,
  sales_rep TEXT NOT NULL,
  month TEXT NOT NULL,
  budgeted_dollars REAL NOT NULL DEFAULT 0,
  budgeted_msf REAL NOT NULL DEFAULT 0,
  budgeted_contribution REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sales_budget_rep_month ON sales_budget(sales_rep, month);
