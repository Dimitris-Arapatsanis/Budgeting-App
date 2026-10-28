ALTER TABLE `categories` ADD `icon` text DEFAULT 'tag' NOT NULL;
--> statement-breakpoint
ALTER TABLE `categories` ADD `color` text DEFAULT 'slate' NOT NULL;
--> statement-breakpoint
-- Εικονίδια/χρώματα για τις αρχικές κατηγορίες σε βάσεις που υπήρχαν ήδη
UPDATE `categories` SET `icon` = 'briefcase', `color` = 'green' WHERE `kind` = 'income' AND `name` = 'Μισθός';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'gift', `color` = 'emerald' WHERE `kind` = 'income' AND `name` = 'Bonus';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'trending-up', `color` = 'teal' WHERE `kind` = 'income' AND `name` = 'Τόκοι/Μερίσματα';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'dollar', `color` = 'blue' WHERE `kind` = 'income' AND `name` = 'Άλλα έσοδα';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'house', `color` = 'indigo' WHERE `kind` = 'expense' AND `name` = 'Στέγαση';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'shopping-cart', `color` = 'emerald' WHERE `kind` = 'expense' AND `name` = 'Σούπερ μάρκετ';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'zap', `color` = 'amber' WHERE `kind` = 'expense' AND `name` = 'Λογαριασμοί';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'car', `color` = 'blue' WHERE `kind` = 'expense' AND `name` = 'Μεταφορές';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'utensils', `color` = 'orange' WHERE `kind` = 'expense' AND `name` = 'Φαγητό έξω';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'clapperboard', `color` = 'violet' WHERE `kind` = 'expense' AND `name` = 'Διασκέδαση';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'heart-pulse', `color` = 'red' WHERE `kind` = 'expense' AND `name` = 'Υγεία';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'shirt', `color` = 'pink' WHERE `kind` = 'expense' AND `name` = 'Ρούχα';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'repeat', `color` = 'teal' WHERE `kind` = 'expense' AND `name` = 'Συνδρομές';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'plane', `color` = 'brown' WHERE `kind` = 'expense' AND `name` = 'Ταξίδια';
--> statement-breakpoint
UPDATE `categories` SET `icon` = 'tag', `color` = 'slate' WHERE `kind` = 'expense' AND `name` = 'Άλλα';
