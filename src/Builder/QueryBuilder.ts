import { Model, Query } from "mongoose";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterQuery<T> = Record<string, any> & Partial<T>;

const DEFAULT_LIMIT = 100;

export interface QueryBuilderOptions {
  /** Fields that are safe to apply regex/text search on in filter() */
  filterableTextFields?: string[];
  /** Fields that are allowed to be used for sorting */
  allowedSortFields?: string[];
  /** Domain-specific "all" fields — if value is "all", the field is removed from the filter */
  allValueFields?: string[];
}

export class QueryBuilder<T> {
  public query: Record<string, unknown>;
  public modelQuery: Query<T[], T>;
  private options: QueryBuilderOptions;

  constructor(
    modelQuery: Query<T[], T>,
    query: Record<string, unknown>,
    options: QueryBuilderOptions = {}
  ) {
    this.query = query;
    this.modelQuery = modelQuery;
    this.options = options;
  }

  search(searchableFields: string[]) {
    let searchTerm = "";

    if (this.query?.searchTerm) {
      // Sanitize to prevent ReDoS attacks
      searchTerm = (this.query.searchTerm as string).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
    }

    this.modelQuery = this.modelQuery.find({
      $or: searchableFields.map((field) => ({
        [field]: new RegExp(searchTerm, "i"),
      })) as FilterQuery<T>[],
    });

    return this;
  }

  paginate() {
    const limit: number = this.query?.limit
      ? Number(this.query.limit)
      : DEFAULT_LIMIT;

    let skip = 0;

    if (this.query?.page) {
      const page = Number(this.query.page) || 1;
      skip = (page - 1) * limit;
    }

    this.modelQuery = this.modelQuery.skip(skip).limit(limit);

    return this;
  }

  sort() {
    let sortBy = "-createdAt";

    if (this.query?.sortBy) {
      const requestedField = this.query.sortBy as string;
      const { allowedSortFields } = this.options;

      // Validate against whitelist if provided
      if (allowedSortFields && !allowedSortFields.includes(requestedField)) {
        console.warn(
          `[QueryBuilder] sort: "${requestedField}" is not in allowedSortFields. Falling back to default.`
        );
      } else {
        const order = (this.query.sortOrder as string) === "desc" ? "-" : "";
        sortBy = `${order}${requestedField}`;
      }
    }

    this.modelQuery = this.modelQuery.sort(sortBy);
    return this;
  }

  fields() {
    if (!this.query?.fields) return this;

    const fields = (this.query.fields as string).split(",").join(" ");
    this.modelQuery = this.modelQuery.select(fields);
    return this;
  }

  filter() {
    const queryObj: Record<string, unknown> = { ...this.query };

    const excludeFields = [
      "searchTerm",
      "page",
      "limit",
      "sortBy",
      "fields",
      "sortOrder",
    ];
    excludeFields.forEach((e) => delete queryObj[e]);

    // Handle domain-specific "all" value fields (passed via options)
    const allValueFields = this.options.allValueFields ?? [];
    allValueFields.forEach((field) => {
      if (queryObj[field] === "all") {
        delete queryObj[field];
      }
    });

    // Handle user equality match
    if (queryObj.user) {
      queryObj.user = { $eq: queryObj.user as string };
    }

    // Only apply regex to explicitly whitelisted text fields
    const filterableTextFields = this.options.filterableTextFields ?? [];
    Object.keys(queryObj).forEach((key) => {
      if (
        typeof queryObj[key] === "string" &&
        filterableTextFields.includes(key)
      ) {
        // Sanitize regex input
        const sanitized = (queryObj[key] as string).replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        queryObj[key] = { $regex: sanitized, $options: "i" };
      }
    });

    this.modelQuery = this.modelQuery.find(queryObj as FilterQuery<T>);
    return this;
  }

  async countTotal() {
    const totalQueries = this.modelQuery.getFilter();
    const total = await (this.modelQuery.model as Model<T>).countDocuments(
      totalQueries
    );

    const page = Number(this.query?.page) || 1;
    const limit = Number(this.query?.limit) || DEFAULT_LIMIT;
    const totalPage = Math.ceil(total / limit);

    return {
      page,
      limit,
      total,
      totalPage,
    };
  }
}