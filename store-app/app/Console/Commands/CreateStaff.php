<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;

class CreateStaff extends Command
{
    protected $signature = 'store:staff {--role=owner : owner or cashier}';

    protected $description = 'Create a staff account; the password is entered privately and stored hashed.';

    public function handle(): int
    {
        $name = $this->ask('Staff name');
        $email = $this->ask('Login email');
        $password = $this->secret('Password (at least 12 characters)');
        $role = $this->option('role');
        $validator = Validator::make(compact('name', 'email', 'password', 'role'), ['name' => 'required|string|max:100', 'email' => 'required|email|max:255|unique:users,email', 'password' => 'required|string|min:12|max:255', 'role' => 'required|in:owner,cashier']);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }
        $user = new User;
        $user->name = $name;
        $user->email = $email;
        $user->password = $password;
        $user->role = $role;
        $user->save();
        $this->info('Staff account created. Sign in using the credentials you entered.');

        return self::SUCCESS;
    }
}
