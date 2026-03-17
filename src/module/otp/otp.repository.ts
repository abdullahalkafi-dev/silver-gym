import { TOTPCreate } from "./otp.interface";
import { OTP } from "./otp.model";

type QueryOptions = {
	select?: Record<string, 0 | 1> | string;
	sort?: Record<string, 1 | -1> | string;
	limit?: number;
	skip?: number;
	populate?: string | string[];
};

export const OTPRepository = {
	create(payload: TOTPCreate) {
		return OTP.create(payload);
	},

	findById(id: string) {
		return OTP.findById(id);
	},

	findOne(filter: object) {
		return OTP.findOne(filter);
	},

	findMany(filter: object = {}, options: QueryOptions = {}) {
		let query = OTP.find(filter);

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
		return OTP.findByIdAndUpdate(id, payload, {
			new: true,
			runValidators: true,
		});
	},

	deleteById(id: string) {
		return OTP.findByIdAndDelete(id);
	},

	deleteMany(filter: object) {
		return OTP.deleteMany(filter);
	},

	async exists(filter: object) {
		const doc = await OTP.exists(filter);
		return Boolean(doc);
	},

	count(filter: object = {}) {
		return OTP.countDocuments(filter);
	},
};
