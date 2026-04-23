-- Add is_admin flag to hosts table
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Mark the original owner as admin
UPDATE hosts SET is_admin = true WHERE email = 'sunday@isunday.me';

-- Admin can read ALL host records (existing policy only allows own record)
DROP POLICY IF EXISTS "Admins can view all hosts" ON hosts;
CREATE POLICY "Admins can view all hosts" ON hosts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.user_id = auth.uid() AND h.is_admin = true
    )
  );

-- Admin can insert new host records (to add other hosts)
DROP POLICY IF EXISTS "Admins can create hosts" ON hosts;
CREATE POLICY "Admins can create hosts" ON hosts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.user_id = auth.uid() AND h.is_admin = true
    )
  );

-- Admin can update host records (e.g. change display_name or revoke admin)
DROP POLICY IF EXISTS "Admins can update all hosts" ON hosts;
CREATE POLICY "Admins can update all hosts" ON hosts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.user_id = auth.uid() AND h.is_admin = true
    )
  );

-- Admin can remove host records
DROP POLICY IF EXISTS "Admins can delete hosts" ON hosts;
CREATE POLICY "Admins can delete hosts" ON hosts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.user_id = auth.uid() AND h.is_admin = true
    )
  );
