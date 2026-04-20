import { TPayment } from "./payment.interface";
import { Payment } from "./payment.model";
import { ClientSession } from "mongoose";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

type CreateOptions = {
  session?: ClientSession;
};

export const PaymentRepository = {
  async create(payload: TPayment, options: CreateOptions = {}) {
    if (options.session) {
      const docs = await Payment.create([payload], { session: options.session });
      return docs[0]!;
    }

    return Payment.create(payload);
  },

  findById(id: string) {
    return Payment.findById(id);
  },

  findOne(filter: object) {
    return Payment.findOne(filter);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = Payment.find(filter);

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
    return Payment.findByIdAndUpdate(id, payload, {
      returnDocument: 'after',
      runValidators: true,
    });
  },

  deleteById(id: string) {
    return Payment.findByIdAndDelete(id);
  },

  async exists(filter: object) {
    const doc = await Payment.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return Payment.countDocuments(filter);
  },
};
