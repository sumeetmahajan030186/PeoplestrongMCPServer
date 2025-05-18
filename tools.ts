import OpenAI from "openai";
import { Agent, fetch } from "undici";

const insecure = new Agent({ connect: { rejectUnauthorized: false } });

/**
 * Simple weather lookup via wttr.in
 */
export async function getWeather(city: string): Promise<string> {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const res = await fetch(url, { dispatcher: insecure as any });
  if (!res.ok) throw new Error(`wttr responded ${res.status}`);
  const { current_condition: [cur] } = await res.json() as any;
  return `Weather in ${city}: ${cur.temp_C} °C, ${cur.weatherDesc[0].value}`;
}

/**
 * Normalize various field-code strings to your canonical API field names
 */
export function normalizeFieldCode(fieldCode: string): string {
  const code = fieldCode.toLowerCase().replace(/\s+/g, "");
  if (code.startsWith("offer"))         return "Offered Date";
  if (code.startsWith("birth") || code.startsWith("dob")) return "Birth Date";
  if (code.startsWith("join"))          return "Date Of Joining";
  if (code.startsWith("confirmation"))  return "Confirmation Date";
  if (code.startsWith("relieving"))     return "Date Of Relieving";
  if (code.startsWith("retirement"))    return "Retirement Date";
  if (code.startsWith("l1"))            return "L1ManagerName";
  if (code.startsWith("l2"))            return "L2ManagerName";
  return fieldCode;
}

/**
 * Fetch an OAuth2 client-credentials token from PeopleStrong
 */
export async function fetchPSToken(
  args: { client_id: string; client_secret: string },
  timeoutMs = 8_000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id:   args.client_id,
      client_secret: args.client_secret
    });
    const res = await fetch(
      "https://uat-auth.peoplestrong.com/auth/realms/3/protocol/openid-connect/token",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: controller.signal }
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`PeopleStrong responded ${res.status}: ${txt}`);
    }
    const json = await res.json() as { access_token?: string };
    if (!json.access_token) throw new Error("No access_token in response");
    return json.access_token;
  } catch (err) {
    // Re‑throw with a consistent prefix so callers can recognise it
    throw new Error(`fetchPSToken failed: ${(err as Error).message}`);
  }
  finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the Kong playground object & extract apiKey + accessToken
 */
export async function getPSTokenWithApiKey(
  args: { organizationId: number; sysModuleName: string; routePath: string },
  timeoutMs = 8_000
): Promise<{ apiKey: string; accessToken: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
  try {
    const url = "https://s2demo-admin.uat.peoplestrong.com/api/integration/client-config/kong/fetchPlaygroundInitObject";
    const body = {
      body: null, subject: null, sendTo: null, cc: null, bcc: null,
      routePath: args.routePath,
      organizationId: args.organizationId,
      sysModuleName: args.sysModuleName
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Accept":       "*/*",
        "Content-Type": "application/json",
        // replace with your real session-Token header if needed
        "session-Token": process.env.PS_SESSION_TOKEN || ""
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    console.log(res);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    const json = await res.json() as any;
    return {
      apiKey:      json.apiKey      ?? "(no apiKey in response)",
      accessToken: json.accessToken ?? "(no accessToken in response)"
    };
  }catch (err: any) {
    // normalize error
    throw new Error(`getPSTokenWithApiKey failed: ${err.message}`);
  }  finally {
    clearTimeout(timer);
  }
}

/**
 * Generic helper to POST to a PeopleStrong integration endpoint
 */
async function psPost(
  url: string,
  args: any,
  apiKey: string,
  accessToken: string,
  timeoutMs = 8_000
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
    let toolResult: string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey":        apiKey,
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify(args),
      signal: controller.signal
    });
    console.log(res);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API error ${res.status}: ${txt}`);
    }
    toolResult = await res.json();
	    let employeeList: any[] = [];
	    if (
	      toolResult &&
	      toolResult.root &&
	      toolResult.root.EmployeeMaster &&
	      Array.isArray(toolResult.root.EmployeeMaster.EmployeeMasterData)
	    ) {
	      employeeList = toolResult.root.EmployeeMaster.EmployeeMasterData;
	    } else {
	      console.warn("⚠️ No valid employee array found");
	    }

	    // Get the top 5 employees
	    const top5 = employeeList.slice(0, 5);
	    toolResult = JSON.stringify(top5);
	    console.log("result fetched");
	  } catch (err: any) {
	    console.error("❌ Detailed error occurred:", err);
	    toolResult = `❌ Error fetching tokens – ${err.message}`;
  } finally {
    clearTimeout(timer);
  }
	    return toolResult;
}

/**
 * Fetch Employee details (1:M dynamicFilter + optional date ranges)
 */
export async function getEmployeeDetails(
  args: {
    dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }>;
    startDate?: { value: string; field: Array<{ fieldCode: string; operator: string }> };
    endDate?:   { value: string; field: Array<{ fieldCode: string; operator: string }> };
  }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:      "/api/integration/Outbound/PeopleStrongHRServices_HRIS_testAgent"
    });

    const payload: any = {
      integrationMasterName: "testAgent",
      dynamicFilter: args.dynamicFilter ?? []
    };

    if (args.startDate?.value) payload.startDate = args.startDate;
    if (args.endDate?.value)   payload.endDate   = args.endDate;

    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_testAgent",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeDetails:", error);
    throw new Error(`getEmployeeDetails failed: ${error.message}`);
  }
}


/**
 * Fetch various Employee “document” details (bank, confirmation, exit, promotion)
 */
export async function getEmployeeBankDocumentDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:      "/api/integration/Outbound/PeopleStrongHRServices_HRIS_testAgent1"
    });

    const payload = {
      integrationMasterName: "testAgent1",
      dynamicFilter: args.dynamicFilter ?? []
    };

    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_testAgent1",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeBankDocumentDetails:", error);
    throw new Error(`getEmployeeBankDocumentDetails failed: ${error.message}`);
  }
}


export async function getEmployeeConfirmationDocumentDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:      "/api/integration/Outbound/PeopleStrongHRServices_HRIS_confirmationAgentTool"
    });

    const payload = {
      integrationMasterName: "confirmationAgentTool",
      dynamicFilter: args.dynamicFilter ?? []
    };

    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_confirmationAgentTool",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeConfirmationDocumentDetails:", error);
    throw new Error(`getEmployeeConfirmationDocumentDetails failed: ${error.message}`);
  }
}

export async function getEmployeePromotionDocumentDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:      "/api/integration/Outbound/PeopleStrongHRServices_HRIS_promotionAgentTool"
    });

    const payload = {
      integrationMasterName: "promotionAgentTool",
      dynamicFilter: args.dynamicFilter ?? []
    };

    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_promotionAgentTool",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeePromotionDocumentDetails:", error);
    throw new Error(`getEmployeePromotionDocumentDetails failed: ${error.message}`);
  }
}


export async function getEmployeeExitDocumentDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:      "/api/integration/Outbound/PeopleStrongHRServices_HRIS_exitDocumentDetails"
    });

    const payload = {
      integrationMasterName: "exitDocumentDetails",
      dynamicFilter: args.dynamicFilter ?? []
    };

    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_exitDocumentDetails",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeExitDocumentDetails:", error);
    throw new Error(`getEmployeeExitDocumentDetails failed: ${error.message}`);
  }
}

export async function getEmployeeIDDocumentDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:      "/api/integration/Outbound/PeopleStrongHRServices_HRIS_IdDocumentDetails"
    });

    const payload = {
      integrationMasterName: "IdDocumentDetails",
      dynamicFilter: args.dynamicFilter ?? []
    };

    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_IdDocumentDetails",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeIDDocumentDetails:", error);
    throw new Error(`getEmployeeIDDocumentDetails failed: ${error.message}`);
  }
}

export async function getEmployeeContactDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:      "/api/integration/Outbound/PeopleStrongHRServices_HRIS_contactAgentTool"
    });

    const payload = {
      integrationMasterName: "contactAgentTool",
      dynamicFilter: args.dynamicFilter ?? []
    };

    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_contactAgentTool",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeContactDetails:", error);
    throw new Error(`getEmployeeContactDetails failed: ${error.message}`);
  }
}


export async function getEmployeeDependentDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:     "/api/integration/Outbound/PeopleStrongHRServices_HRIS_dependentAgenttool"
    });
    const payload = { integrationMasterName: "dependentAgenttool", dynamicFilter: args.dynamicFilter ?? [] };
    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_dependentAgenttool",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeDependentDetails:", error);
    throw new Error(`getEmployeeDependentDetails failed: ${error.message}`);
  }
}


export async function getEmployeeEmergencyContactDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:     "/api/integration/Outbound/PeopleStrongHRServices_HRIS_emergencyAgentTool"
    });
    const payload = { integrationMasterName: "emergencyAgentTool", dynamicFilter: args.dynamicFilter ?? [] };
    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_emergencyAgentTool",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeEmergencyContactDetails:", error);
    throw new Error(`getEmployeeEmergencyContactDetails failed: ${error.message}`);
  }
}


export async function getEmployeeSkillDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:     "/api/integration/Outbound/PeopleStrongHRServices_HRIS_skillAgentTool"
    });
    const payload = { integrationMasterName: "skillAgentTool", dynamicFilter: args.dynamicFilter ?? [] };
    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_skillAgentTool",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeSkillDetails:", error);
    throw new Error(`getEmployeeSkillDetails failed: ${error.message}`);
  }
}


export async function getEmployeeTransferDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "HRIS",
      routePath:     "/api/integration/Outbound/PeopleStrongHRServices_HRIS_transferAgentTool"
    });
    const payload = { integrationMasterName: "transferAgentTool", dynamicFilter: args.dynamicFilter ?? [] };
    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_HRIS_transferAgentTool",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getEmployeeTransferDetails:", error);
    throw new Error(`getEmployeeTransferDetails failed: ${error.message}`);
  }
}




/**
 * Fetch Candidate details
 */
export async function getCandidateDetails(
  args: { dynamicFilter?: Array<{ fieldCode: string; operator: string; value: string }> }
): Promise<any> {
  try {
    const { apiKey, accessToken } = await getPSTokenWithApiKey({
      organizationId: 3,
      sysModuleName:  "Recruit",
      routePath:     "/api/integration/Outbound/PeopleStrongHRServices_Recruit_candidateDetailsTool"
    });
    const payload = { integrationMasterName: "candidateDetailsTool", dynamicFilter: args.dynamicFilter ?? [] };
    return await psPost(
      "https://uat-api.peoplestrong.com/api/integration/Outbound/PeopleStrongHRServices_Recruit_candidateDetailsTool",
      payload,
      apiKey,
      accessToken
    );
  } catch (error: any) {
    console.error("❌ Error in getCandidateDetails:", error);
    throw new Error(`getCandidateDetails failed: ${error.message}`);
  }
}


