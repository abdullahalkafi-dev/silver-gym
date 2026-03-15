import { TUser } from "./user.interface";
import { User } from "./user.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

export const UserRepository = {
  create(payload: TUser) {
    return User.create(payload);
  },

  findById(id: string) {
    return User.findById(id);
  },

  findOne(filter: object) {
    return User.findOne(filter);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = User.find(filter);

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
    return User.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });
  },

  deleteById(id: string) {
    return User.findByIdAndDelete(id);
  },

  async exists(filter: object) {
    const doc = await User.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return User.countDocuments(filter);
  },
};
