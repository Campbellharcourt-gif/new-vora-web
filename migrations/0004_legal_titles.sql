-- Legal page titles: "Terms & Conditions" and "Privacy Policy".
-- Only never-published working copies that still carry the original seed titles are renamed;
-- anything an editor has changed or published is left exactly as it is.
UPDATE `pages` SET `title` = 'Terms & Conditions'
WHERE `key` = 'terms' AND `title` = 'Terms' AND `published_version_id` IS NULL;
--> statement-breakpoint
UPDATE `pages` SET `title` = 'Privacy Policy'
WHERE `key` = 'privacy' AND `title` = 'Privacy' AND `published_version_id` IS NULL;
