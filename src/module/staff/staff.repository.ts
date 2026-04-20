import { TStaff } from "./staff.interface";
import { Staff } from "./staff.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

type FindOneOptions = Pick<QueryOptions, "select" | "populate">;

export const StaffRepository = {
  create(payload: TStaff) {
    return Staff.create(payload);
  },

  findById(id: string) {
    return Staff.findById(id);
  },

  findOne(filter: object, options: FindOneOptions = {}) {
    let query = Staff.findOne(filter);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.populate) {
      if (Array.isArray(options.populate)) {
        options.populate.forEach((path) => {
          query = query.populate(path);
        });
      } else {
        query = query.populate(options.populate);
      }
    }

    return query;
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = Staff.find(filter);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.sort) {
      query = query.sort(options.sort);
    }

    if (typeof options.skip === "number") {
      query = query.skip(options.skip);
    }

    if (typeof options.limit === "number") {
      query = query.limit(options.limit);
    }

    if (options.populate) {
      if (Array.isArray(options.populate)) {
        options.populate.forEach((path) => {
          query = query.populate(path);
        });
      } else {
        query = query.populate(options.populate);
      }
    }

    return query;
  },

  updateById(id: string, payload: object) {
    return Staff.findByIdAndUpdate(id, payload, {
      returnDocument: 'after',
      runValidators: true,
    });
  },

  deleteById(id: string) {
    return Staff.findByIdAndDelete(id);
  },

  async exists(filter: object) {
    const doc = await Staff.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return Staff.countDocuments(filter);
  },
};
