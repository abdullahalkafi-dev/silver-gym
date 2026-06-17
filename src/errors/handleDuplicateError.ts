/* eslint-disable @typescript-eslint/no-explicit-any */

import { TErrorSources, TGenericErrorResponse } from "../types/error";




const handleDuplicateError = (err: any): TGenericErrorResponse => {
  const indexMatch = err.message?.match(/index:\s*(\S+)/);
  const indexName = indexMatch?.[1] || "unknown";

  const match = err.message?.match(/"([^"]*)"/);
  const extractedMessage = match?.[1];

  let detail = extractedMessage ? `${extractedMessage} is already exists` : "Value already exists";

  if (indexName.includes("contact")) {
    detail = "A member with this phone number already exists in this branch";
  } else if (indexName.includes("barcode")) {
    detail = "A member with this barcode already exists in this branch";
  } else if (indexName.includes("systemMemberId")) {
    detail = "Member ID conflict — please try again";
  } else if (indexName.includes("email")) {
    detail = "A member with this email already exists in this branch";
  }

  const errorSources: TErrorSources = [
    {
      path: indexName.replace(/^branchId_1_/, "").replace(/_1$/, ""),
      message: detail,
    },
  ];

  const statusCode = 400;

  return {
    statusCode,
    message: "Duplicate value",
    errorSources,
  };
};

export default handleDuplicateError;
