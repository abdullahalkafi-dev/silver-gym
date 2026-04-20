import { TUser } from 'module/user/user.interface';
import {
  TStaffPermissionSnapshot,
  TStaffTokenPayload,
} from 'module/auth/auth.util';
import { TStaff } from 'module/staff/staff.interface';

declare global {
  namespace Express {
    interface Request {
      user?: TUser;
      staff?: TStaff;
      staffAuth?: TStaffTokenPayload;
      staffPermissions?: TStaffPermissionSnapshot;
    }
  }
}
