import { TRole } from "./role.interface";
import { Role } from "./role.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

export const RoleRepository = {
  create(payload: TRole) {
    return Role.create(payload);
  },

  findById(id: string) {
    return Role.findById(id);
  },

  findOne(filter: object) {
    return Role.findOne(filter);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = Role.find(filter);

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
    return Role.findByIdAndUpdate(id, payload, {
      returnDocument: 'after',
      runValidators: true,
    });
  },

  deleteById(id: string) {
    return Role.findByIdAndDelete(id);
  },

  async exists(filter: object) {
    const doc = await Role.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return Role.countDocuments(filter);
  },
};
