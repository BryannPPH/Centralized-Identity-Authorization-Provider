export function hasAllowedGroup(
  allowedGroupIds: Iterable<string>,
  userGroupIds: Iterable<string>
): boolean {
  const allowed = new Set(allowedGroupIds);

  for (const groupId of userGroupIds) {
    if (allowed.has(groupId)) {
      return true;
    }
  }

  return false;
}
