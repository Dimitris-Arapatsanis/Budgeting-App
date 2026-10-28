-- Λογαριασμός «Μετρητά» (υπόλοιπο 0) σε βάσεις που υπήρχαν ήδη και δεν έχουν λογαριασμό μετρητών.
-- Σε καινούργια βάση (άδειος πίνακας) δεν κάνει τίποτα: τον φτιάχνει το seed μαζί με τους υπόλοιπους.
INSERT INTO `accounts` (`name`, `type`, `initial_balance`, `archived`, `sort_order`)
SELECT 'Μετρητά', 'cash', 0, 0, (SELECT MAX(`sort_order`) + 1 FROM `accounts`)
WHERE EXISTS (SELECT 1 FROM `accounts`)
  AND NOT EXISTS (SELECT 1 FROM `accounts` WHERE `type` = 'cash');
