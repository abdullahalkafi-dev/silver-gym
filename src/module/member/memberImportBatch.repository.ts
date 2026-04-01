import { PipelineStage } from "mongoose";
import { TMemberImportBatch } from "./memberImportBatch.interface";
import { MemberImportBatch } from "./memberImportBatch.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

export const MemberImportBatchRepository = {
  create(payload: TMemberImportBatch) {
    return MemberImportBatch.create(payload);
  },

  findById(id: string) {
    return MemberImportBatch.findById(id);
  },

  findOne(filter: object) {
    return MemberImportBatch.findOne(filter);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = MemberImportBatch.find(filter);

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

  aggregate(pipeline: PipelineStage[] = []) {
    return MemberImportBatch.aggregate(pipeline);
  },

  updateById(id: string, payload: object) {
    return MemberImportBatch.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
    });
  },

  count(filter: object = {}) {
    return MemberImportBatch.countDocuments(filter);
  },

  async exists(filter: object) {
    const doc = await MemberImportBatch.exists(filter);
    return Boolean(doc);
  },
};
