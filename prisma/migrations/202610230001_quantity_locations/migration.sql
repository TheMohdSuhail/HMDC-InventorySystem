ALTER TABLE `User` ALTER COLUMN `role` SET DEFAULT 'BRANCH_MANAGER';
UPDATE `User` SET `role` = 'BRANCH_MANAGER' WHERE `role` = 'USER';
CREATE TABLE `LocationBalance` (
 `ownerId` VARCHAR(191) NOT NULL, `productId` VARCHAR(191) NOT NULL,
 `quantity` DECIMAL(18,3) NOT NULL DEFAULT 0,
 PRIMARY KEY (`ownerId`,`productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `QuantityEvent` (
 `id` VARCHAR(191) NOT NULL, `requestKey` VARCHAR(64) NOT NULL, `fingerprint` VARCHAR(64) NOT NULL,
 `type` VARCHAR(32) NOT NULL, `actorId` VARCHAR(191) NOT NULL, `ownerId` VARCHAR(191) NOT NULL,
 `sourceId` VARCHAR(191) NULL, `notes` TEXT NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`), UNIQUE INDEX `QuantityEvent_requestKey_key` (`requestKey`), INDEX `QuantityEvent_ownerId_createdAt_idx` (`ownerId`,`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `QuantityLine` (
 `id` VARCHAR(191) NOT NULL, `eventId` VARCHAR(191) NOT NULL, `productId` VARCHAR(191) NOT NULL,
 `quantity` DECIMAL(18,3) NOT NULL, `processed` DECIMAL(18,3) NOT NULL DEFAULT 0,
 `boxes` INTEGER NOT NULL DEFAULT 0, `piecesPerBox` INTEGER NOT NULL DEFAULT 1, `loosePieces` INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (`id`), INDEX `QuantityLine_eventId_idx` (`eventId`),
 CONSTRAINT `QuantityLine_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `QuantityEvent` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
