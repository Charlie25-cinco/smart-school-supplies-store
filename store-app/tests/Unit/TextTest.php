<?php

namespace Tests\Unit;

use App\Support\Text;
use PHPUnit\Framework\TestCase;

class TextTest extends TestCase
{
    public function test_words_capitalizes_first_letters_and_keeps_the_rest(): void
    {
        $this->assertSame('Juan Dela Cruz', Text::words('juan dela cruz'));
        $this->assertSame('McDONALD Usb Cable', Text::words('mcDONALD usb cable'));
        $this->assertSame("O'Brien Blk 5", Text::words("o'brien blk 5"));
        $this->assertSame('', Text::words(null));
        $this->assertSame('', Text::words(''));
    }

    public function test_words_supports_multibyte_and_optional_maximum(): void
    {
        $this->assertSame('José Rizal', Text::words('josé rizal'));
        $this->assertSame('Abc', Text::words('abcdef', 3));
    }
}
