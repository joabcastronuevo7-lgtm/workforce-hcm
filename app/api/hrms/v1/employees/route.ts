import { handleHrms } from "../handler";
import { loadEmployees } from "../data";
import { handleImport } from "./import";

// GET reads (HRMS_API_KEY); POST imports (HRMS_IMPORT_KEY). Other methods get 405 from Next.js. See HRMS_API.md.
export async function GET(request: Request) {
  return handleHrms(request, "employees", loadEmployees);
}

export async function POST(request: Request) {
  return handleImport(request);
}
