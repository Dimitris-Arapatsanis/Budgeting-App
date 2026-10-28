CREATE TABLE `fx_cache` (
	`pair` text NOT NULL,
	`date` text NOT NULL,
	`rate` real NOT NULL,
	PRIMARY KEY(`pair`, `date`)
);
--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_ticker_unique` ON `instruments` (`ticker`);--> statement-breakpoint
CREATE TABLE `pie_slices` (
	`pie_id` integer NOT NULL,
	`instrument_id` integer NOT NULL,
	`target_percent` real NOT NULL,
	PRIMARY KEY(`pie_id`, `instrument_id`),
	FOREIGN KEY (`pie_id`) REFERENCES `pies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`account_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `price_cache` (
	`instrument_id` integer NOT NULL,
	`date` text NOT NULL,
	`close` real NOT NULL,
	`currency` text NOT NULL,
	PRIMARY KEY(`instrument_id`, `date`),
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`account_id` integer NOT NULL,
	`instrument_id` integer NOT NULL,
	`side` text NOT NULL,
	`quantity` real NOT NULL,
	`amount_eur` integer NOT NULL,
	`pie_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pie_id`) REFERENCES `pies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `trades_date_idx` ON `trades` (`date`);