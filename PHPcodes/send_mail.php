<?php
if(isset($_POST['submit'])){

$to      = 'ondra.mich@seznam.cz';
$subject = $_POST['subject'];
$message = $_POST['message'];
$headers = 'From: ' . 'michaleon@ms.mff.cuni.cz' . "\r\n" .
'Reply-To: ' . $_POST['email'] . "\r\n" .
'X-Mailer: PHP/' . phpversion();


if (mail($to,$subject,$message,$headers))
{
    echo "Message accepted";
}
else
{
    echo "Error: Message not accepted";
}
?>
