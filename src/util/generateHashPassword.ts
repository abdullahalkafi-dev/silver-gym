import config from "@config/index";
import bcrypt from "bcryptjs";
const generateHashPassword = (password: string): string => {
  const saltRounds = Number(config.bcrypt_salt_rounds);
  return bcrypt.hashSync(password, saltRounds);
};
export default generateHashPassword;
