-- Create a trigger to automatically add users with specific emails as hosts
CREATE OR REPLACE FUNCTION public.handle_new_user_host()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if the new user's email is in the allowed hosts list
  IF NEW.email = 'sunday@isunday.me' THEN
    INSERT INTO public.hosts (user_id, email, display_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'Isunday'))
    ON CONFLICT (email) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created_host ON auth.users;

-- Create trigger to run after user signup
CREATE TRIGGER on_auth_user_created_host
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_host();
