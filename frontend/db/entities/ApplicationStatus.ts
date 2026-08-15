import { EntitySchema } from "typeorm";

interface ApplicationStatus {
  key: string;
  value: string;
  updatedAt: Date;
}

export const ApplicationStatusEntity = new EntitySchema<ApplicationStatus>({
  name: "ApplicationStatus",
  tableName: "application_status",
  columns: {
    key: { type: String, length: 64, primary: true },
    value: { type: String, length: 255 },
    updatedAt: { name: "updated_at", type: "timestamptz", createDate: true },
  },
});
