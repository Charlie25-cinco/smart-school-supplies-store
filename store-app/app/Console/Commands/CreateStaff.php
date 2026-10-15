<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class CreateStaff extends Command
{
    protected $signature = 'store:staff {--role=admin : admin or cashier; owner is a legacy alias for admin}';

    protected $description = 'Create a staff account; the password is entered privately and stored hashed.';

    public function handle(): int
    {
        $name = $this->ask('Staff name');
        $username = $this->ask('Username (letters, numbers, hyphens, 3-40 characters)');
        $username = is_string($username) ? Str::lower(trim($username)) : $username;
        $password = $this->secret('Password (at least 12 characters)');
        $role = $this->option('role');
        $role = $role === 'owner' ? 'admin' : $role;
        $validator = Validator::make(compact('name', 'username', 'password', 'role'), ['name' => 'required|string|max:100', 'username' => ['required', 'string', 'regex:/^[A-Za-z0-9-]{3,40}$/', function ($attribute, $value, $fail) {
            if (User::whereRaw('LOWER(username) = ?', [Str::lower($value)])->exists()) {
                $fail('The username has already been taken.');
            }
        }], 'password' => 'required|string|min:12|max:255', 'role' => 'required|in:admin,cashier']);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }
        $user = new User;
        $user->name = $name;
        $user->username = $username;
        $user->password = $password;
        $user->role = $role;
        $user->active = true;
        $user->save();
        $this->info('Staff account created. Sign in using the credentials you entered.');

        return self::SUCCESS;
    }
}
