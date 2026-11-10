CREATE TABLE `TeamMember` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(16) NOT NULL,
  `phone` VARCHAR(64) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TeamMember_code_key`(`code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SalesOrder` (
  `id` VARCHAR(191) NOT NULL,
  `orderNo` VARCHAR(64) NOT NULL,
  `teamMemberId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SalesOrder_orderNo_key`(`orderNo`),
  INDEX `SalesOrder_teamMemberId_idx`(`teamMemberId`),
  INDEX `SalesOrder_ownerId_updatedAt_idx`(`ownerId`, `updatedAt`),
  INDEX `SalesOrder_updatedAt_idx`(`updatedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SalesOrder_teamMemberId_fkey` FOREIGN KEY (`teamMemberId`)
    REFERENCES `TeamMember`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SalesOrderItem` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18, 3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SalesOrderItem_orderId_productId_key`(`orderId`, `productId`),
  INDEX `SalesOrderItem_productId_idx`(`productId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SalesOrderItem_orderId_fkey` FOREIGN KEY (`orderId`)
    REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SalesOrderItem_productId_fkey` FOREIGN KEY (`productId`)
    REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
