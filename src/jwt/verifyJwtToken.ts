import jwt, { JwtPayload, Secret } from "jsonwebtoken";

const verifyJwtToken = (token: string, secret: Secret) => {
  return jwt.verify(token, secret) as JwtPayload;
};
export default verifyJwtToken;
