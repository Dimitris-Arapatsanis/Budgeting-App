CREATE TABLE `recurring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount` integer NOT NULL,
	`account_id` integer NOT NULL,
	`to_account_id` integer,
	`category_id` integer,
	`instrument_id` integer,
	`pie_id` integer,
	`funding_account_id` integer,
	`frequency` text NOT NULL,
	`day` integer NOT NULL,
	`month` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pie_id`) REFERENCES `pies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`funding_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring_skips` (
	`recurring_id` integer NOT NULL,
	`due_date` text NOT NULL,
	PRIMARY KEY(`recurring_id`, `due_date`),
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `trades` ADD `recurring_id` integer REFERENCES recurring(id);--> statement-breakpoint
ALTER TABLE `trades` ADD `recurring_due` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_id` integer REFERENCES recurring(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_due` text;