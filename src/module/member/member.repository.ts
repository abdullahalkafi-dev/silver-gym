import { TMember } from "./member.interface";
import { Member } from "./member.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

export const MemberRepository = {
  create(payload: TMember) {
    return Member.create(payload);
  },

  findById(id: string) {
    return Member.findById(id);
  },

  findOne(filter: object) {
    return Member.findOne(filter);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = Member.find(filter);

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
    return Member.findByIdAndUpdate(id, payload, {
      returnDocument: 'after',
      runValidators: true,
    });
  },

  deleteById(id: string) {
    return Member.findByIdAndDelete(id);
  },

  async exists(filter: object) {
    const doc = await Member.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return Member.countDocuments(filter);
  },
};
