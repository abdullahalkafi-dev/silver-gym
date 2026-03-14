export const normalizeQuery = (query: Record<string, unknown>) => {
    return Object.keys(query)
      .sort()
      .reduce((obj, key) => {
        let value = query[key];
        // Normalize empty strings, nulls, or undefined to a standard value
        if (value === undefined || value === null || value === "") {
          value = "";
        }
  
        // Sort array values (like fields=email,name) for consistent ordering
        if (typeof value === "string" && value.includes(",")) {
          value = value
            .split(",")
            .map((v) => v.trim())
            .sort()
            .join(",");
        }
  
        obj[key] = value;
        return obj;
      }, {} as Record<string, unknown>);
  };