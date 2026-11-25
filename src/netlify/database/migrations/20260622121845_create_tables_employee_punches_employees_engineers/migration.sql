CREATE TABLE "employee_punches" (
	"id" text PRIMARY KEY,
	"employee_id" text NOT NULL,
	"employee_name" text NOT NULL,
	"punch_type" text NOT NULL,
	"timestamp" text NOT NULL,
	"machine_id" text NOT NULL,
	"date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engineers" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspectors" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" text PRIMARY KEY,
	"timestamp" text NOT NULL,
	"pool_id" text NOT NULL,
	"pool_no" text NOT NULL,
	"project_name" text NOT NULL,
	"stage_id" text NOT NULL,
	"type" text NOT NULL,
	"team_name" text,
	"notes" text,
	"operator_name" text NOT NULL,
	"inspector_picture" text
);
--> statement-breakpoint
CREATE TABLE "monthly_targets" (
	"id" text PRIMARY KEY,
	"month_name" text NOT NULL,
	"main_target" integer NOT NULL,
	"steel_fabrication_target" integer NOT NULL,
	"steel_primer_target" integer NOT NULL,
	"plumbing_target" integer NOT NULL,
	"cladding_target" integer NOT NULL,
	"skimmer_fitting_target" integer DEFAULT 110 NOT NULL,
	"lamination_target" integer NOT NULL,
	"mechanical_fitting_target" integer NOT NULL,
	"skimmer_test_target" integer DEFAULT 100 NOT NULL,
	"door_cutting_target" integer DEFAULT 100 NOT NULL,
	"mosaic_target" integer NOT NULL,
	"grouting_target" integer DEFAULT 120 NOT NULL,
	"acrylic_target" integer NOT NULL,
	"target_oee" integer DEFAULT 85,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "planned_pools" (
	"id" text PRIMARY KEY,
	"project_name" text NOT NULL,
	"pool_no" text NOT NULL,
	"orientation" text NOT NULL,
	"dimensions" text NOT NULL,
	"shape" text NOT NULL,
	"pool_type" text,
	"drawing_url" text,
	"status" text NOT NULL,
	"released_pool_id" text,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" text PRIMARY KEY,
	"project_name" text NOT NULL,
	"pool_no" text NOT NULL,
	"orientation" text NOT NULL,
	"dimensions" text NOT NULL,
	"shape" text NOT NULL,
	"pool_type" text,
	"drawing_url" text,
	"notes" text,
	"created_at" text NOT NULL,
	"completed_at" text,
	"is_delivered" boolean DEFAULT false,
	"delivered_at" text,
	"current_stage_index" integer NOT NULL,
	"stage_history" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects_summary" (
	"id" text PRIMARY KEY,
	"project_name" text NOT NULL,
	"orientation" text NOT NULL,
	"pool_type" text NOT NULL,
	"total_pools" integer NOT NULL,
	"delivered_pools" integer NOT NULL,
	"produced_pools" integer NOT NULL,
	"remaining_pools" integer NOT NULL,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recycle_bin" (
	"id" text PRIMARY KEY,
	"data_type" text NOT NULL,
	"deleted_at" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY,
	"stage_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"active_pool_id" text
);
--> statement-breakpoint
CREATE TABLE "trolley_production" (
	"id" text PRIMARY KEY,
	"date" text NOT NULL,
	"team_name" text NOT NULL,
	"quantity_produced" integer NOT NULL,
	"notes" text,
	"created_at" text NOT NULL
);
