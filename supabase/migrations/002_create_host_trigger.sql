-- Create a function to automatically create a host record when a new user signs up
CREATE OR REPLACE FUNCTION create_host_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert into hosts table with the new user's information
  INSERT INTO hosts (user_id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.email,
      'Host'
    )
  );
  
  RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Create a trigger that fires after a new user is created
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_host_on_signup();

-- Update the existing host record for sunday@isunday.me if it exists
UPDATE hosts 
SET display_name = 'Sunday Stream'
WHERE email = 'sunday@isunday.me';

-- If no host record exists, create one
INSERT INTO hosts (user_id, email, display_name)
SELECT 
  id,
  email,
  'Sunday Stream'
FROM auth.users 
WHERE email = 'sunday@isunday.me'
ON CONFLICT (user_id) DO UPDATE
SET display_name = 'Sunday Stream';
