CREATE TABLE monitoring_budget (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 day date NOT NULL,
 used integer NOT NULL CHECK (used >= 0)
);
