import { TPackage } from "./package.interface";
import { Package } from "./package.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

export const PackageRepository = {
  create(payload: TPackage) {
    return Package.create(payload);
  },

  findById(id: string) {
    return Package.findById(id);
  },

  findOne(filter: object) {
    return Package.findOne(filter);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = Package.find(filter);

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
    return Package.findByIdAndUpdate(id, payload, {
      returnDocument: 'after',
      runValidators: true,
    });
  },

  deleteById(id: string) {
    return Package.findByIdAndDelete(id);
  },

  async exists(filter: object) {
    const doc = await Package.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return Package.countDocuments(filter);
  },
};
