import { TErrorSources, TGenericErrorResponse } from "types/error";
import z, { ZodError } from "zod";

// Helper function to generate user-friendly error messages
const generateUserFriendlyMessage = (issue: z.core.$ZodIssue): string => {
  const fieldName = issue?.path[issue.path.length - 1] || "Field";

  // Format field name: convert camelCase to Title Case with spaces
  const formattedFieldName = String(fieldName)
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
    .replace(/^./, (str) => str.toUpperCase());

  switch (issue.code) {
    case "invalid_type": {
      const received = issue.input;
      if (received === undefined || received === null) {
        return `${formattedFieldName} is required`;
      }

      const receivedType = typeof received;
      const expectedType = String(issue.expected);

      const typeMap: Record<string, string> = {
        string: "text",
        number: "number",
        boolean: "true/false value",
        array: "list",
        object: "valid data",
        date: "date",
      };

      const friendlyExpected = typeMap[expectedType] || expectedType;
      const friendlyReceived = typeMap[receivedType] || receivedType;

      return `${formattedFieldName} must be a ${friendlyExpected}, but received ${friendlyReceived}`;
    }

    case "invalid_format": {
      const formatMap: Record<string, string> = {
        email: `${formattedFieldName} must be a valid email address`,
        url: `${formattedFieldName} must be a valid URL`,
        uuid: `${formattedFieldName} must be a valid UUID`,
        regex: `${formattedFieldName} format is invalid`,
        date: `${formattedFieldName} must be a valid date`,
        datetime: `${formattedFieldName} must be a valid date and time`,
        time: `${formattedFieldName} must be a valid time`,
        ip: `${formattedFieldName} must be a valid IP address`,
        cidr: `${formattedFieldName} must be a valid CIDR notation`,
        jwt: `${formattedFieldName} must be a valid JWT`,
        base64: `${formattedFieldName} must be valid base64`,
      };

      const format = issue.format;
      return formatMap[format] || `${formattedFieldName} format is invalid`;
    }

    case "too_small": {
      const origin = issue.origin;
      if (origin === "string") {
        return `${formattedFieldName} must be at least ${issue.minimum} characters long`;
      }
      if (origin === "number" || origin === "bigint") {
        return `${formattedFieldName} must be at least ${issue.minimum}`;
      }
      if (origin === "array" || origin === "set") {
        return `${formattedFieldName} must contain at least ${issue.minimum} item(s)`;
      }
      return `${formattedFieldName} is too small (minimum: ${issue.minimum})`;
    }

    case "too_big": {
      const origin = issue.origin;
      if (origin === "string") {
        return `${formattedFieldName} must be at most ${issue.maximum} characters long`;
      }
      if (origin === "number" || origin === "bigint") {
        return `${formattedFieldName} must be at most ${issue.maximum}`;
      }
      if (origin === "array" || origin === "set") {
        return `${formattedFieldName} must contain at most ${issue.maximum} item(s)`;
      }
      return `${formattedFieldName} is too large (maximum: ${issue.maximum})`;
    }

    case "invalid_value":
      if ("values" in issue && Array.isArray(issue.values)) {
        return `${formattedFieldName} must be one of: ${issue.values.join(", ")}`;
      }
      return `${formattedFieldName} has an invalid value`;

    case "unrecognized_keys":
      return `Unrecognized field(s): ${issue.keys?.join(", ")}`;

    case "not_multiple_of":
      return `${formattedFieldName} must be a multiple of ${issue.divisor}`;

    case "invalid_union":
      return `${formattedFieldName} does not match any of the expected types`;

    case "invalid_key":
      return `${formattedFieldName} contains an invalid key`;

    case "invalid_element":
      return `${formattedFieldName} contains an invalid element`;

    case "custom":
      return issue.message || `${formattedFieldName} is invalid`;
  }

  // Fallback for any future issue codes
  return `${formattedFieldName} is invalid`;
};

const handleZodError = (err: ZodError): TGenericErrorResponse => {
  const errorSources: TErrorSources = err.issues.map(
    (issue: z.core.$ZodIssue) => {
      const rawPath = issue?.path[issue.path.length - 1];
      let path: string | number;

      if (typeof rawPath === "string" || typeof rawPath === "number") {
        path = rawPath;
      } else if (typeof rawPath === "symbol") {
        path = rawPath.toString();
      } else {
        path = "unknown";
      }

      return {
        path,
        message: generateUserFriendlyMessage(issue),
      };
    },
  );

  const statusCode = 400;

  let message: string;
  if (errorSources.length === 1 && errorSources[0]) {
    message = errorSources[0].message;
  } else if (errorSources.length === 2) {
    message = `Invalid input for ${errorSources.map((e) => e.path).join(" and ")}`;
  } else {
    message = `${errorSources.length} validation errors found. Please check your input.`;
  }

  return {
    statusCode,
    message,
    errorSources,
  };
};
export default handleZodError;
