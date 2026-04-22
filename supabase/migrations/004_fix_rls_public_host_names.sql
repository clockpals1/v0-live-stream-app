-- Allow anyone to read host display names / emails (public info needed by viewer pages)
-- Previously only the host themselves could read their own profile, which blocked
-- anonymous viewers from seeing the host name on the watch page.
DROP POLICY IF EXISTS "Anyone can view host public info" ON hosts;
CREATE POLICY "Anyone can view host public info" ON hosts
  FOR SELECT USING (true);
