// import { User } from "../app/modules/user/user.model";
// import config from "../config";

// import { logger } from "../shared/logger";
// import { TUser } from "../app/modules/user/user.interface";

// const superUser: TUser = {
//   firstName: "Abdullah",
//   lastName: "Al Kafi",
//   role: "ADMIN",
//   email: config.super_admin.email!,
//   verified: true,
//   pushNotification: true,
//   allProfileFieldsFilled: false,
//   allUserFieldsFilled: false,
//   status: "active",
//   isProfileVerified: true,
//   isPersonaVerified: false,
// };

// const seedSuperAdmin = async () => {
//   const isExistSuperAdmin = await User.findOne({
//     role: "ADMIN",
//   });

//   if (!isExistSuperAdmin) {
//     await User.create(superUser);
//     logger.info(colors.green("✔ Super admin created successfully!"));
//   }
// };

// export default seedSuperAdmin;
