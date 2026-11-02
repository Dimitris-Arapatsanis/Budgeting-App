ALTER TABLE `trades` ADD `funding_fee` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `fee_for_id` integer;--> statement-breakpoint
-- Κατηγορία για τις χρεώσεις (fees) σε βάσεις που υπήρχαν ήδη. Σε νέα βάση τη βάζει το seed.
INSERT INTO `categories` (`name`, `kind`, `icon`, `color`) SELECT 'Χρεώσεις', 'expense', 'landmark', 'red' WHERE EXISTS (SELECT 1 FROM `categories`) AND NOT EXISTS (SELECT 1 FROM `categories` WHERE `name` = 'Χρεώσεις' AND `kind` = 'expense');
