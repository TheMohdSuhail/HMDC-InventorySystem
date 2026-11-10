ALTER TABLE `SalesOrder`
  ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'PLACED',
  ADD COLUMN `statusNote` TEXT NULL,
  ADD COLUMN `statusAt` DATETIME(3) NULL;

CREATE INDEX `SalesOrder_status_idx` ON `SalesOrder`(`status`);
CREATE INDEX `SalesOrder_createdAt_idx` ON `SalesOrder`(`createdAt`);
