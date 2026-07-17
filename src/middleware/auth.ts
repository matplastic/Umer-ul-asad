import { Request, Response, NextFunction } from 'express';

// This checks if the user is logged in. If not, it stops them.
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authedUser = (req as any).user;
  if (!authedUser || !authedUser.role) {
    return res.status(401).json({ error: 'Not signed in. Please log in again.' });
  }
  next();
};

// This checks if the user has the right job title (role) to do the action.
export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authedUser = (req as any).user;
    if (!authedUser || !authedUser.role) {
      return res.status(401).json({ error: 'Not signed in. Please log in again.' });
    }
    if (!allowedRoles.includes(authedUser.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
};
