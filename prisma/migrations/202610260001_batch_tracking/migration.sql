CREATE TABLE `Batch` (
  `id` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `manufacturerId` VARCHAR(191) NULL,
  `batchNo` VARCHAR(191) NOT NULL,
  `mfgDate` DATE NULL,
  `expiryDate` DATE NULL,
  `isLegacy` BOOLEAN NOT NULL DEFAULT false,
  `identityKey` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Batch_identityKey_key` (`identityKey`),
  UNIQUE INDEX `Batch_productId_manufacturerId_batchNo_key`
    (`productId`, `manufacturerId`, `batchNo`),
  INDEX `Batch_productId_expiryDate_idx` (`productId`, `expiryDate`),
  INDEX `Batch_manufacturerId_idx` (`manufacturerId`),
  CONSTRAINT `Batch_productId_fkey` FOREIGN KEY (`productId`)
    REFERENCES `Product` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `Batch_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`)
    REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `Batch_identity_check` CHECK (
    (`isLegacy` = true AND `manufacturerId` IS NULL
      AND `batchNo` = 'LEGACY / UNASSIGNED'
      AND `mfgDate` IS NULL AND `expiryDate` IS NULL
      AND BINARY `identityKey` = BINARY CONCAT('LEGACY:', `productId`))
    OR
    (`isLegacy` = false AND `manufacturerId` IS NOT NULL
      AND CHAR_LENGTH(TRIM(`batchNo`)) > 0
      AND `mfgDate` IS NOT NULL AND `expiryDate` IS NOT NULL
      AND `mfgDate` <= `expiryDate`
      AND BINARY `identityKey` = BINARY CONCAT('BATCH:', `id`))
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BatchBalance` (
  `ownerId` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL DEFAULT 0,
  `damaged` DECIMAL(18,3) NOT NULL DEFAULT 0,
  `expired` DECIMAL(18,3) NOT NULL DEFAULT 0,
  `quarantined` DECIMAL(18,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (`ownerId`, `batchId`),
  INDEX `BatchBalance_batchId_idx` (`batchId`),
  CONSTRAINT `BatchBalance_batchId_fkey` FOREIGN KEY (`batchId`)
    REFERENCES `Batch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `BatchBalance_nonnegative_check` CHECK (
    `quantity` >= 0 AND `damaged` >= 0
    AND `expired` >= 0 AND `quarantined` >= 0
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `QuantityLineBatch` (
  `lineId` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `processed` DECIMAL(18,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (`lineId`, `batchId`),
  INDEX `QuantityLineBatch_batchId_idx` (`batchId`),
  CONSTRAINT `QuantityLineBatch_lineId_fkey` FOREIGN KEY (`lineId`)
    REFERENCES `QuantityLine` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `QuantityLineBatch_batchId_fkey` FOREIGN KEY (`batchId`)
    REFERENCES `Batch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `QuantityLineBatch_quantity_check` CHECK (
    `quantity` > 0 AND `processed` >= 0 AND `processed` <= `quantity`
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SaleItemBatch` (
  `saleItemId` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `returned` DECIMAL(18,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (`saleItemId`, `batchId`),
  INDEX `SaleItemBatch_batchId_idx` (`batchId`),
  CONSTRAINT `SaleItemBatch_saleItemId_fkey` FOREIGN KEY (`saleItemId`)
    REFERENCES `SaleItem` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SaleItemBatch_batchId_fkey` FOREIGN KEY (`batchId`)
    REFERENCES `Batch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SaleItemBatch_quantity_check` CHECK (
    `quantity` > 0 AND `returned` >= 0 AND `returned` <= `quantity`
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
