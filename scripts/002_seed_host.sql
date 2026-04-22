-- This script should be run AFTER a user signs up with sunday@isunday.me
-- It will create a host record for that user
-- Note: Run this after the user has signed up and confirmed their email

-- Insert host record for the specified email
-- The user_id will need to be obtained from auth.users after signup
INSERT INTO public.hosts (user_id, email, display_name)
SELECT id, email, 'Isunday Host'
FROM auth.users
WHERE email = 'sunday@isunday.me'
ON CONFLICT (email) DO NOTHING;
