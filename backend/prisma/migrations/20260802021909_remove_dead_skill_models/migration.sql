/*
  Warnings:

  - You are about to drop the `project_skills` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `skills` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "project_skills" DROP CONSTRAINT "project_skills_projectId_fkey";

-- DropForeignKey
ALTER TABLE "project_skills" DROP CONSTRAINT "project_skills_skillId_fkey";

-- DropTable
DROP TABLE "project_skills";

-- DropTable
DROP TABLE "skills";
