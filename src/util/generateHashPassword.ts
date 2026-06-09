import config from "@config/index";
import bcrypt from "bcryptjs";
const generateHashPassword = async (password: string): Promise<string> => {
  const saltRounds = Number(config.bcrypt_salt_rounds) || 10;
  return bcrypt.hash(password, saltRounds);
};
export default generateHashPassword;
